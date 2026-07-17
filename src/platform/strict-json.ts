export function parseJsonWithoutDuplicateKeys(text: string): unknown {
  let index = 0;
  const whitespace = (): void => {
    while (/\s/.test(text[index] ?? "")) index++;
  };
  const string = (): string => {
    const start = index;
    if (text[index++] !== '"') throw new SyntaxError("Expected JSON string");
    let escaped = false;
    while (index < text.length) {
      const character = text[index++]!;
      if (!escaped && character === '"')
        return JSON.parse(text.slice(start, index)) as string;
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
    }
    throw new SyntaxError("Unterminated JSON string");
  };
  const value = (depth: number): unknown => {
    if (depth > 100) throw new SyntaxError("JSON nesting limit exceeded");
    whitespace();
    const character = text[index];
    if (character === '"') return string();
    if (character === "{") {
      index++;
      const result: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      const keys = new Set<string>();
      whitespace();
      if (text[index] === "}") {
        index++;
        return result;
      }
      while (true) {
        whitespace();
        const key = string();
        if (keys.has(key)) throw new SyntaxError(`Duplicate JSON key: ${key}`);
        keys.add(key);
        whitespace();
        if (text[index++] !== ":") throw new SyntaxError("Expected colon");
        result[key] = value(depth + 1);
        whitespace();
        const separator = text[index++];
        if (separator === "}") return result;
        if (separator !== ",") throw new SyntaxError("Expected comma");
      }
    }
    if (character === "[") {
      index++;
      const result: unknown[] = [];
      whitespace();
      if (text[index] === "]") {
        index++;
        return result;
      }
      while (true) {
        result.push(value(depth + 1));
        whitespace();
        const separator = text[index++];
        if (separator === "]") return result;
        if (separator !== ",") throw new SyntaxError("Expected comma");
      }
    }
    const remainder = text.slice(index);
    const token =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
        remainder,
      )?.[0];
    if (!token) throw new SyntaxError("Invalid JSON value");
    index += token.length;
    return JSON.parse(token) as unknown;
  };
  const parsed = value(0);
  whitespace();
  if (index !== text.length) throw new SyntaxError("Trailing JSON content");
  return parsed;
}
