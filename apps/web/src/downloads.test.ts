import { afterEach, describe, expect, it, vi } from "vitest";
import { installCommandForThisComputer } from "./downloads.ts";

describe("installCommandForThisComputer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the PowerShell one-liner on Windows", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      platform: "Win32",
    });
    expect(installCommandForThisComputer()).toBe(
      "irm https://folderlink.muiz.pk/install.ps1 | iex",
    );
  });

  it("returns the shell installer on macOS and Linux", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
    });
    expect(installCommandForThisComputer()).toBe(
      "curl -fsSL https://folderlink.muiz.pk/install.sh | sh",
    );
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      platform: "Linux x86_64",
    });
    expect(installCommandForThisComputer()).toBe(
      "curl -fsSL https://folderlink.muiz.pk/install.sh | sh",
    );
  });

  it("defaults to the shell installer when the platform is unknown", () => {
    vi.stubGlobal("navigator", undefined);
    expect(installCommandForThisComputer()).toBe(
      "curl -fsSL https://folderlink.muiz.pk/install.sh | sh",
    );
  });
});
