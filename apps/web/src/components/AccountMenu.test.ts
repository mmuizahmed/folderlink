import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar } from "./AccountMenu.tsx";
import type { SessionUser } from "../data/types.ts";

const photoUser: SessionUser = {
  id: "u1",
  email: "muiz@example.com",
  name: "Muiz Ahmed",
  avatarUrl: "https://example.com/photo.jpg",
};
const plainUser: SessionUser = {
  id: "u1",
  email: "muiz@example.com",
  name: "Muiz Ahmed",
};

describe("Avatar", () => {
  it("renders the Google photo when avatarUrl is set", () => {
    const html = renderToStaticMarkup(createElement(Avatar, { user: photoUser }));
    expect(html).toContain('<img class="avatar" src="https://example.com/photo.jpg"');
  });

  it("falls back to initials without a photo", () => {
    const html = renderToStaticMarkup(createElement(Avatar, { user: plainUser }));
    expect(html).toContain('<span class="avatar">MA</span>');
  });

  it("falls back to initials for an empty photo url", () => {
    const html = renderToStaticMarkup(
      createElement(Avatar, { user: { ...plainUser, avatarUrl: "" } }),
    );
    expect(html).toContain('<span class="avatar">MA</span>');
  });

  it("passes a size class through to the photo and the initials", () => {
    const photo = renderToStaticMarkup(createElement(Avatar, { user: photoUser, className: "lg" }));
    expect(photo).toContain('class="avatar lg"');
    const plain = renderToStaticMarkup(createElement(Avatar, { user: plainUser, className: "xl" }));
    expect(plain).toContain('class="avatar xl"');
  });
});
