// Steam avatars are public CDN images. Reject other URLs at both runtime and view boundaries.
export function steamAvatarUrl(value: unknown): string | undefined {
	return typeof value === 'string' && /^https:\/\/avatars\.(?:(?:cloudflare|akamai|fastly)\.)?steamstatic\.com\/[a-f0-9]{40}(?:_(?:medium|full))?\.jpg$/i.test(value)
		? value
		: undefined;
}
