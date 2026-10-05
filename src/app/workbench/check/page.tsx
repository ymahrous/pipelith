import type { Metadata } from "next";
import { CheckStep } from "@/components/steps-ui/CheckStep";

export const metadata: Metadata = {
  title: "Check",
  description: "Check a program against the expectations in its comments, such as R1=5 or C --> 1.",
  alternates: { canonical: "/workbench/check" },
};

export default function Page() {
  return <CheckStep />;
}
