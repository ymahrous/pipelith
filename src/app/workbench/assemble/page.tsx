import type { Metadata } from "next";
import { AssembleStep } from "@/components/steps-ui/AssembleStep";

export const metadata: Metadata = {
  title: "Assemble",
  description: "Assemble a program to 32-bit machine code bit-for-bit compatible with the reference assembler, with diagnostics and a downloadable .mem image.",
  alternates: { canonical: "/workbench/assemble" },
};

export default function Page() {
  return <AssembleStep />;
}
