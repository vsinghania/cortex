import { getEncoding, type Tiktoken, type TiktokenEncoding } from 'js-tiktoken';

const DEFAULT_ENCODING: TiktokenEncoding = 'cl100k_base';

export class Tokenizer {
  private static encoders = new Map<TiktokenEncoding, Tiktoken>();

  private constructor() {}

  static countTokens(text: string, encoding: TiktokenEncoding = DEFAULT_ENCODING): number {
    return Tokenizer.getEncoder(encoding).encode(text).length;
  }

  static encode(text: string, encoding: TiktokenEncoding = DEFAULT_ENCODING): number[] {
    return Tokenizer.getEncoder(encoding).encode(text);
  }

  static decode(tokens: number[], encoding: TiktokenEncoding = DEFAULT_ENCODING): string {
    return Tokenizer.getEncoder(encoding).decode(tokens);
  }

  static truncate(text: string, max_tokens: number, encoding: TiktokenEncoding = DEFAULT_ENCODING): string {
    const encoder = Tokenizer.getEncoder(encoding);
    const tokens = encoder.encode(text);
    if (tokens.length <= max_tokens) return text;
    return encoder.decode(tokens.slice(0, max_tokens));
  }

  private static getEncoder(encoding: TiktokenEncoding): Tiktoken {
    let encoder = Tokenizer.encoders.get(encoding);
    if (!encoder) {
      encoder = getEncoding(encoding);
      Tokenizer.encoders.set(encoding, encoder);
    }
    return encoder;
  }
}
