import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { listCategoryOptions } from "@/server/utils/categories";

export async function GET() {
  try {
    const categories = await listCategoryOptions(db);
    return NextResponse.json({ categories });
  } catch (error) {
    console.error("Mobile categories error:", error);
    return NextResponse.json(
      { error: "Failed to load categories" },
      { status: 500 }
    );
  }
}
