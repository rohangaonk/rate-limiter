import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as appconfig from 'aws-cdk-lib/aws-appconfig';
import * as path from 'path';

export class RateLimiterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── VPC ───────────────────────────────────────────────────────────────────
    // Use the account's default VPC to keep costs low.
    // Subnets already exist, no NAT gateway costs.
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    // ─── Security Groups ───────────────────────────────────────────────────────
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'Allow HTTP from anywhere to ALB',
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from internet');

    const appSg = new ec2.SecurityGroup(this, 'AppSg', {
      vpc,
      description: 'ECS app task security group',
      allowAllOutbound: true,
    });
    // Allow ALB to reach app on port 3000
    appSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'ALB to app');

    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc,
      description: 'ElastiCache Redis security group',
      allowAllOutbound: false,
    });
    // Allow ECS app to reach Redis on 6379
    redisSg.addIngressRule(appSg, ec2.Port.tcp(6379), 'App to Redis');

    // ─── ElastiCache Redis (single node, t4g.micro) ────────────────────────────
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for rate-limiter Redis',
      subnetIds: vpc.publicSubnets.map((s) => s.subnetId),
      cacheSubnetGroupName: 'rate-limiter-redis-subnet-group',
    });

    const redis = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      engine: 'redis',
      cacheNodeType: 'cache.t4g.micro',
      numCacheNodes: 1,
      clusterName: 'rate-limiter-redis',
      vpcSecurityGroupIds: [redisSg.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.ref,
    });
    redis.addDependency(redisSubnetGroup);

    // ─── AWS AppConfig ─────────────────────────────────────────────────────────
    const appConfigApp = new appconfig.CfnApplication(this, 'AppConfigApp', {
      name: 'rate-limiter',
      description: 'Rate limiter dynamic rule configuration',
    });

    const appConfigEnv = new appconfig.CfnEnvironment(this, 'AppConfigEnv', {
      applicationId: appConfigApp.ref,
      name: 'production',
    });

    const appConfigProfile = new appconfig.CfnConfigurationProfile(this, 'AppConfigProfile', {
      applicationId: appConfigApp.ref,
      name: 'rules',
      locationUri: 'hosted',
      type: 'AWS.Freeform',
    });

    // Initial rules document (same as .env defaults)
    const initialRules = JSON.stringify([
      { prefix: 'ip',     capacity: 200, refillRate: 30 },
      { prefix: 'user',   capacity: 50,  refillRate: 10 },
      { prefix: 'apikey', capacity: 100, refillRate: 20 },
    ]);

    const hostedConfigVersion = new appconfig.CfnHostedConfigurationVersion(
      this, 'AppConfigInitialVersion',
      {
        applicationId: appConfigApp.ref,
        configurationProfileId: appConfigProfile.ref,
        content: initialRules,
        contentType: 'application/json',
      },
    );

    // Instant deployment strategy (no bake time) — good for dev/cost-conscious
    const deploymentStrategy = new appconfig.CfnDeploymentStrategy(
      this, 'AppConfigDeploymentStrategy',
      {
        name: 'rate-limiter-instant',
        deploymentDurationInMinutes: 0,
        growthFactor: 100,
        replicateTo: 'NONE',
        finalBakeTimeInMinutes: 0,
      },
    );

    new appconfig.CfnDeployment(this, 'AppConfigInitialDeployment', {
      applicationId: appConfigApp.ref,
      environmentId: appConfigEnv.ref,
      configurationProfileId: appConfigProfile.ref,
      configurationVersion: hostedConfigVersion.ref,
      deploymentStrategyId: deploymentStrategy.ref,
    });

    // ─── IAM Task Role ─────────────────────────────────────────────────────────
    const taskRole = new iam.Role(this, 'EcsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Allows ECS tasks to read AppConfig',
    });

    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'appconfig:GetLatestConfiguration',
        'appconfig:StartConfigurationSession',
      ],
      resources: ['*'],
    }));

    // ─── ECS Cluster + Task Definition ────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'rate-limiter-cluster',
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Container 1: NestJS app
    // fromAsset builds the Dockerfile and pushes to a CDK-managed ECR repo on `cdk deploy`
    const appContainer = taskDef.addContainer('app', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '..', '..'), {
        platform: Platform.LINUX_AMD64,
        exclude: ['infra/cdk.out'],
      }),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'rate-limiter-app' }),
      environment: {
        PORT: '3000',
        NODE_ENV: 'production',
        APP_MODE: 'aws',
        REDIS_HOST: redis.attrRedisEndpointAddress,
        REDIS_PORT: redis.attrRedisEndpointPort,
        APPCONFIG_APP: 'rate-limiter',
        APPCONFIG_ENV: 'production',
        APPCONFIG_PROFILE: 'rules',
        // Fallback rules used by AppConfigRulesProvider if AppConfig is empty or unreachable.
        // These mirror the initial rules deployed to AppConfig and ensure fail-closed behaviour.
        RATE_LIMIT_RULES: JSON.stringify([
          { prefix: 'ip',     capacity: 200, refillRate: 30 },
          { prefix: 'user',   capacity: 50,  refillRate: 10 },
          { prefix: 'apikey', capacity: 100, refillRate: 20 },
        ]),
      },
      essential: true,
    });

    // Container 2: AppConfig agent sidecar
    // Exposes localhost:2772 inside the task; the app polls it for live config
    taskDef.addContainer('appconfig-agent', {
      image: ecs.ContainerImage.fromRegistry(
        'public.ecr.aws/aws-appconfig/aws-appconfig-agent:2.x',
      ),
      portMappings: [{ containerPort: 2772 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'rate-limiter-appconfig-agent' }),
      environment: {
        SERVICE_REGION: this.region,
      },
      essential: false,
    });

    // App starts after the sidecar is ready
    appContainer.addContainerDependencies({
      container: taskDef.findContainer('appconfig-agent')!,
      condition: ecs.ContainerDependencyCondition.START,
    });

    // ─── Fargate Service ───────────────────────────────────────────────────────
    const fargateService = new ecs.FargateService(this, 'FargateService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true,
      securityGroups: [appSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      serviceName: 'rate-limiter-service',
      // Single task (cost-conscious): allow 0 running during deploys
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
    });

    // ─── ALB ───────────────────────────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
      loadBalancerName: 'rate-limiter-alb',
    });

    const listener = alb.addListener('HttpListener', { port: 80, open: false });

    listener.addTargets('AppTarget', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [fargateService],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        healthyHttpCodes: '200',
      },
      deregistrationDelay: cdk.Duration.seconds(15),
    });

    // ─── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AlbDns', {
      value: alb.loadBalancerDnsName,
      description: 'ALB DNS — use this to test the rate limiter',
    });

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redis.attrRedisEndpointAddress,
      description: 'ElastiCache Redis endpoint',
    });

    new cdk.CfnOutput(this, 'AppConfigAppId', {
      value: appConfigApp.ref,
      description: 'AppConfig application ID',
    });
  }
}
