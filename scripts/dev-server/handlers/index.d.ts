export type HandlerRequest = {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  signal: AbortSignal;
};

export type HandlerResult =
  | { status: number; headers?: Record<string, string>; json: unknown }
  | {
      status: number;
      headers: Record<string, string>;
      stream: import('node:stream').Readable;
      length?: number;
    }
  | {
      status: 200;
      sse: {
        subscribe(emit: (event: string, data: unknown, id?: number) => void, since: number): () => void;
      };
    };

export type Route = {
  method: 'GET' | 'POST' | 'HEAD';
  pattern: RegExp;
  handler: (req: HandlerRequest, params: Record<string, string>) => Promise<HandlerResult>;
};

export type HandlerContext = {
  projectRoot: string;
  presetsDir: string;
  outputDir: string;
  cacheDir: string;
  schemaPath: string;
};

export function createHandlers(context?: Partial<HandlerContext>): Route[];
export function matchRoute(
  routes: Route[],
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null;
