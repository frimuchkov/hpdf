import type {Config} from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  forceExit: true,
  detectOpenHandles: true,
  collectCoverage: true,
  testRegex: ".test.ts$"

};

export default config;