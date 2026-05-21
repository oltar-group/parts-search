export class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.providerId = options.providerId;
    this.status = options.status;
    this.cause = options.cause;
  }

  toJSON() {
    return {
      providerId: this.providerId,
      code: this.code,
      message: this.message,
      status: this.status
    };
  }
}

export function providerErrorToResponse(error, provider) {
  if (error instanceof ProviderError) {
    return error.toJSON();
  }

  return {
    providerId: provider?.id,
    code: "provider_error",
    message: error?.message || "Provider request failed"
  };
}

