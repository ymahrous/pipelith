import type { Metadata } from "next";
import { ReviewPage } from "@/components/review/ReviewPage";

export const metadata: Metadata = {
  title: "VHDL code review",
  description:
    "Upload your VHDL processor codebase and get a review with errors, warnings and suggested fixes: syntax, connectivity, latches, sensitivity lists and pipeline/forwarding checks. Runs in your browser.",
  alternates: { canonical: "/review" },
};

export default function Page() {
  return <ReviewPage />;
}
