# Contributing

Thanks for helping improve CS2 Lobby Stats.

## Before opening an issue

- Confirm the Steam profile is public.
- Check whether the same player has data on the relevant provider.
- Include the Steam profile URL, Millennium version, plugin version, and a screenshot.
- Do not post API keys or other private credentials.

## Development

1. Fork and clone the repository.
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Make a focused change.
4. Run the required checks:

```powershell
pnpm typecheck
pnpm build
pnpm dlx luaparse backend/main.lua
git diff --check
```

5. Test both a profile with Premier data and a profile without it in the Steam desktop client.

Keep third-party integrations isolated and return partial data when possible. A missing optional metric should not fail the whole profile or emit a plugin warning.
