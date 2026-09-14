import { NextResponse } from "next/server";

const association = {
  applinks: {
    details: [
      {
        appIDs: ["99YPVP2249.com.pumpslate.app"],
        components: [{ "/": "/join/*" }],
      },
    ],
  },
};

export function GET() {
  return NextResponse.json(association, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
