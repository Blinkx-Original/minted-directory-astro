declare module "*.toml" {
  const value: any;
  export default value;
}

declare module '@aws-sdk/client-s3' {
  interface S3ClientConfig {
    region?: string;
    endpoint?: string;
    credentials?: {
      accessKeyId: string;
      secretAccessKey: string;
    };
    forcePathStyle?: boolean;
  }

  export class S3Client {
    constructor(config: S3ClientConfig);
    send<T>(command: any): Promise<T>;
  }

  export class ListObjectsV2Command {
    constructor(input: Record<string, unknown>);
  }

  export class PutObjectCommand {
    constructor(input: Record<string, unknown>);
  }

  export class GetObjectCommand {
    constructor(input: Record<string, unknown>);
  }

  export class DeleteObjectCommand {
    constructor(input: Record<string, unknown>);
  }
}