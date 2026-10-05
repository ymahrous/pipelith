export const STEPS = [
  { slug: "program", label: "Program", title: "Write or load a program" },
  { slug: "assemble", label: "Assemble", title: "Assemble to machine code" },
  { slug: "simulate", label: "Simulate", title: "Run the reference model" },
  { slug: "check", label: "Check", title: "Check expected results" },
  { slug: "compare", label: "Compare", title: "Compare with your hardware" },
  { slug: "report", label: "Report", title: "Report and share" },
] as const;

export type StepSlug = (typeof STEPS)[number]["slug"];
