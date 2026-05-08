export class WslCommandError extends Error {
  readonly command: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(input: {
    readonly command: readonly string[];
    readonly exitCode: number | null;
    readonly stderr: string;
    readonly message: string;
    readonly cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "WslCommandError";
    this.command = input.command;
    this.exitCode = input.exitCode;
    this.stderr = input.stderr;
  }
}

export class WslInvalidTargetError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "WslInvalidTargetError";
  }
}

export class WslLaunchError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = "WslLaunchError";
  }
}
