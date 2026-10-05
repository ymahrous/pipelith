import type { Metadata } from "next";
import { ProgramStep } from "@/components/steps-ui/ProgramStep";

export const metadata: Metadata = {
  title: "Program",
  description: "Write or load a program for the pipelined RISC reference model: bundled tests, .asm or .mem files, and pipeline and forwarding settings.",
  alternates: { canonical: "/workbench/program" },
};

export default function Page() {
  return <ProgramStep />;
}
