/** Troubleshooting entries. Titles quote the app's real messages where there is one. */

export interface Problem {
  id: string;
  group: "Uploads and code review" | "Programs" | "Running your hardware" | "Comparison" | "Browser";
  symptom: string;
  answer: string;
  steps?: string[];
  link?: { href: string; label: string };
}

export const PROBLEMS: readonly Problem[] = [
  {
    id: "no-vhdl",
    group: "Uploads and code review",
    symptom: "“No .vhd or .vhdl files found”",
    answer: "The upload had no VHDL sources, usually because the .zip holds another .zip, or the files use another extension.",
    steps: ["Unpack any inner .zip and zip the project folder itself.", "Rename sources to .vhd or .vhdl.", "Or use Choose a folder and pick the project folder."],
    link: { href: "/guide#zip", label: "How to structure your .zip" },
  },
  {
    id: "zip-damaged",
    group: "Uploads and code review",
    symptom: "“This is not a .zip file, or it is damaged”",
    answer: "The archive isn't a standard .zip: .7z, .rar, password-protected and Zip64 archives aren't supported.",
    steps: ["Re-create it with your operating system's built-in Compress / Send to → Compressed folder.", "Or skip zipping and use Choose a folder."],
  },
  {
    id: "too-large",
    group: "Uploads and code review",
    symptom: "“The .zip is larger than 50 MB” or “More than 1500 VHDL files”",
    answer: "The upload includes more than the design — simulator output, IP caches or several projects.",
    steps: ["Zip only the RTL folder.", "On Linux or WSL: zip -r my-cpu.zip my-cpu -i '*.vhd' '*.vhdl' '*.asm'"],
  },
  {
    id: "package-missing",
    group: "Uploads and code review",
    symptom: "“Package … is not in the upload” or “… isn't defined”",
    answer: "A file uses a package or instantiates an entity whose source wasn't included. Code review needs the whole design.",
    steps: ["Add the missing file to the .zip.", "Vendor primitives (unisim and similar) are expected to be missing and only produce warnings."],
    link: { href: "/docs/review-rules#missing-package", label: "Rule: missing-package" },
  },
  {
    id: "defined-twice",
    group: "Uploads and code review",
    symptom: "“Entity … is defined twice”",
    answer: "Two files define the same entity, often an old copy in a backup folder.",
    steps: ["Remove the copy you don't use and upload one design per .zip."],
  },
  {
    id: "wrong-depth",
    group: "Uploads and code review",
    symptom: "“The code looks like a 6-stage pipeline, but 5 stages are selected”",
    answer: "The pipeline registers found match the other depth.",
    steps: ["Switch Pipeline depth in the settings panel; the review re-runs instantly.", "Name pipeline registers after the stages they sit between (if_id, id_ex, ex_mem, mem_wb, or id_ex1, ex1_ex2, ex2_mem)."],
  },
  {
    id: "asm-errors",
    group: "Programs",
    symptom: "The Assemble step lists errors",
    answer: "Every error has a line number and links back to the editor. Unlike assembler.py, Pipelith reports all errors at once.",
    steps: ["Click the line number to jump to it.", "Numbers are hex: write 10, not 16, for sixteen.", "Warnings flag silent mistakes such as overlapping .ORG regions; they don't stop the run."],
    link: { href: "/isa", label: "Instruction set" },
  },
  {
    id: "reset-vector",
    group: "Programs",
    symptom: "“M[0] (reset vector) is never set, so execution starts at address 0”",
    answer: "Execution starts at the address stored in M[0].",
    steps: ["Add .ORG 0 followed by the start address on its own line, then .ORG <start> before the code."],
  },
  {
    id: "checks-missing",
    group: "Programs",
    symptom: "A comment didn't become a check",
    answer: "Checks are read from comments on instruction lines only, with numbers in hex and flag letters in capitals (Z, N, C).",
    link: { href: "/docs/checks", label: "Check comment syntax" },
  },
  {
    id: "ghdl-not-found",
    group: "Running your hardware",
    symptom: "run_ghdl.sh says “ghdl: command not found”",
    answer: "GHDL isn't installed or isn't on PATH.",
    steps: ["Install GHDL 4.x (package manager, Homebrew, or the GHDL releases page).", "Check with ghdl --version, then run the script again."],
  },
  {
    id: "compile-order",
    group: "Running your hardware",
    symptom: "GHDL or ModelSim reports “unit … not found” while compiling",
    answer: "Files are compiled in the wrong order, or the RTL folder path is wrong.",
    steps: ["Run Code review on your RTL and choose Use this order in the hardware kit.", "Set RTL folder in Compare to the folder that holds your .vhd files, relative to where you unzip the kit, then download the kit again."],
  },
  {
    id: "vhdl-2008",
    group: "Running your hardware",
    symptom: "Errors about external names or “<< signal … >>”",
    answer: "The generated testbench uses VHDL-2008 to watch internal registers.",
    steps: ["Keep the --std=08 (GHDL) or -2008 (ModelSim/Questa) flags the scripts already pass.", "In Vivado, set the testbench file type to VHDL 2008."],
  },
  {
    id: "signals-not-mapped",
    group: "Comparison",
    symptom: "Channels show “Not mapped”",
    answer: "Your design names its registers differently from what the auto-mapping looks for.",
    steps: ["Open Signal mapping under the results and pick the right signal for each channel.", "Registers, SP and OUT need 32-bit signals; flags can be any width, with Z, N, C in bits 0, 1, 2."],
  },
  {
    id: "ends-early",
    group: "Comparison",
    symptom: "A channel says “Ends early”",
    answer: "The simulation stopped before the model's last write, or the write never happened.",
    steps: ["Raise Clock cycles in Compare and download the kit again.", "If more cycles don't help, the instruction that should write the value never completed — look at that instruction in the trace."],
  },
  {
    id: "timing-off",
    group: "Comparison",
    symptom: "The cycle count is far from the estimate",
    answer: "Either the pipeline settings don't describe your design, or the design stalls more (or less) than it needs to.",
    steps: ["Check Pipeline depth and Forwarding allowed match your design.", "If they do, look for unnecessary stalls (slower) or missing hazard stalls (faster)."],
    link: { href: "/guide#forwarding", label: "Forwarding settings" },
  },
  {
    id: "vcd-errors",
    group: "Comparison",
    symptom: "“The file ended before $enddefinitions — is this a VCD file?”",
    answer: "The waveform is truncated or in another format (.wlf, .ghw, .fst).",
    steps: ["Let the simulation finish so the VCD is closed properly.", "Export VCD: the kit's scripts already do; in ModelSim use vcd file / vcd add, in Vivado open_vcd / log_vcd."],
  },
  {
    id: "lost-work",
    group: "Browser",
    symptom: "My program disappeared",
    answer: "Work is saved in this browser only. Private windows, clearing site data or another browser start empty.",
    steps: ["Use Copy share link or download the report to keep a copy.", "Uploaded codebases and waveforms are never saved — open them again."],
  },
];

export const PROBLEM_GROUPS = [...new Set(PROBLEMS.map((p) => p.group))];
