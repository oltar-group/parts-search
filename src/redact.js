export function redactSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/token|password|secret|credential/i.test(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactSensitive(entry);
    }
  }

  return redacted;
}

