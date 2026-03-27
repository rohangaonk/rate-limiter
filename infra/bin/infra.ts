#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RateLimiterStack } from '../lib/infra-stack';

const app = new cdk.App();

new RateLimiterStack(app, 'RateLimiterStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-south-1',
  },
  description: 'Rate limiter — ECS Fargate + ElastiCache + AppConfig (ap-south-1)',
});
