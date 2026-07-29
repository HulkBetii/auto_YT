import { describe, expect, it } from "vitest";

import { POST as createVideo } from "./videos/route";
import { POST as assembleVideo } from "./videos/[id]/assemble/route";
import { POST as createWeek } from "./weeks/route";
import { POST as scanWeek } from "./weeks/[id]/scan/route";

function request(body: unknown): Request {
  const secret = process.env.DASHBOARD_SECRET;
  return new Request("http://localhost:3002/api/study/test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("study API validation", () => {
  it("rejects an invalid week number before touching the database", async () => {
    const response = await createWeek(request({ weekNumber: 54 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("rejects an invalid day number before touching the database", async () => {
    const response = await createVideo(request({ dayNumber: 366 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("rejects malformed resource IDs before touching the database", async () => {
    const scanResponse = await scanWeek(request({}), { params: Promise.resolve({ id: "x" }) });
    const assembleResponse = await assembleVideo(request({}), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(scanResponse.status).toBe(400);
    expect(assembleResponse.status).toBe(400);
  });

  it("requires an explicit commercial-rights confirmation for every audio scan", async () => {
    const response = await scanWeek(request({}), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(response.status).toBe(400);
  });
});
