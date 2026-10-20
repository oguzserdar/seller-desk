# shadcn Sidebar sources

Official shadcn/ui New York v4 Sidebar and its registry dependencies. Source: https://github.com/shadcn-ui/ui/tree/c2477f311c19982ef6e246085438e6cfec3e35ea/apps/v4/registry/new-york-v4 . MIT, see LICENSE. Imported directly, not reconstructed. Import paths are local. Sheet/Sidebar accept a portal container so the existing desk theme reaches mobile navigation. Application passes banner offset through the documented className API. Component visual classes otherwise remain upstream. Dependencies are exact in package.json and pnpm-lock.yaml.

Avatar and DropdownMenu were added from the same pinned public MIT source for Sidebar-07 NavUser. The app account row preserves that block’s visual classes, removes fictional demo destinations and wires only real owner settings/sign-out. DropdownMenu accepts an optional palette portal container. No private source was copied.

For this Vinext integration, Button has an explicit use client boundary. A bounded comparison proved that the full candidate compiles with only that directive added; the prior source also compiled, while removing the rich-text editor alone did not clear the stall. Public Button visual classes and API are unchanged. See the UI source inventory.
