// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}

		/**
		 * Cloudflare Pages bindings exposed via `event.platform.env`.
		 * Bindings are declared in `wrangler.toml`. Slice 2 will add a KV namespace
		 * for the schedule scrape; for Slice 1 nothing is bound.
		 */
		interface Platform {
			/**
			 * Cloudflare bindings declared in `wrangler.toml`.
			 * Empty in Slice 1; Slice 2 will add `SCHEDULE_KV: KVNamespace`.
			 */
			env: Record<string, unknown>;
			context: {
				waitUntil(promise: Promise<unknown>): void;
			};
			caches: CacheStorage & { default: Cache };
		}
	}
}

export {};
