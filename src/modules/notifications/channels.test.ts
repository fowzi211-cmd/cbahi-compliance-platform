import { describe, expect, it } from "vitest";
import { channels, externalChannels } from "./channels";

describe("external channels", () => {
  it.each(externalChannels)("%s is a stub that sends nothing", async (name) => {
    expect(channels[name].configured).toBe(false);
    expect(await channels[name].send({ to: "+966500000000", text: "x", locale: "ar" })).toEqual({
      ok: false,
      reason: "notConfigured",
    });
  });
});
