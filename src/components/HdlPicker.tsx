"use client";

import { useId } from "react";
import { HDL_INFO, HDLS, toHdl } from "@/lib/hdl";
import { withHdl } from "@/lib/session/session";
import { useWorkbench } from "./SessionProvider";

/**
 * The design language (VHDL, Verilog or SystemVerilog), in the header of every
 * page. Kits, sample codebases, the .zip guide and code examples follow it.
 */
export function HdlPicker() {
  const { session, update, toast } = useWorkbench();
  const id = useId();
  return (
    <div className="hdl-picker">
      <label htmlFor={id} className="hdl-picker__label">
        HDL
      </label>
      <select
        id={id}
        aria-label="HDL (design language)"
        value={session.hdl}
        onChange={(e) => {
          const hdl = toHdl(e.target.value);
          if (!hdl || hdl === session.hdl) return;
          const cleared = !!session.compileOrder && !withHdl(session, hdl).compileOrder;
          update((s) => withHdl(s, hdl));
          toast(
            `Design language: ${HDL_INFO[hdl].label}. Kits, samples and examples now use it.${cleared ? " The compile order from your earlier review was cleared." : ""}`,
          );
        }}
      >
        {HDLS.map((h) => (
          <option key={h} value={h}>
            {HDL_INFO[h].label}
          </option>
        ))}
      </select>
    </div>
  );
}
