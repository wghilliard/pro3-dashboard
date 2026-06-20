import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Deploy target: Cloudflare Pages (with optional Workers KV / D1 bindings).
			// See https://kit.svelte.dev/docs/adapter-cloudflare
			adapter: adapter({
				platformProxy: {
					configPath: 'wrangler.toml',
					persist: true
				}
			})
		})
	]
});
