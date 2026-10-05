import type { Metadata } from "next";
import { ReportStep } from "@/components/steps-ui/ReportStep";

export const metadata: Metadata = {
  title: "Report",
  description: "Export a validation report as Markdown or JSON, or share the setup as a link.",
  alternates: { canonical: "/workbench/report" },
};

export default function Page() {
  return <ReportStep />;
}
