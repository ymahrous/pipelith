# Pipelith 5-stage reference processor (SystemVerilog)

The SystemVerilog (IEEE 1800-2017) version of the 5-stage reference processor in `../verilog`. It is generated from the Verilog sources by `scripts/build-reference.mjs`, so the two never drift apart: `reg`/`wire` declarations become `logic`, clocked blocks become `always_ff`, combinational blocks `always_comb`, and files use `.sv`/`.svh`.

| | |
| --- | --- |
| Stages | IF → ID → EX → MEM → WB |
| Forwarding | Full: EX/MEM and MEM/WB into EX; the register file writes before it reads |
| Hazards | One-cycle load-use stall; conditional branches resolve in EX; JMP/CALL resolve in decode |
| Memory | One port for instructions and data; a load or store in MEM delays fetch by a cycle |
| Reset | Active low and synchronous; PC loads M[0] while reset is held |

Don't edit these files by hand — change `../verilog/rtl` and run `node scripts/build-reference.mjs`.

## Run it

With **SystemVerilog** and **5 stages** selected in Pipelith, download the hardware kit from the Compare step and run:

```bash
./run_icarus.sh path/to/reference/systemverilog/rtl     # Icarus Verilog (-g2012)
./run_verilator.sh path/to/reference/systemverilog/rtl  # Verilator 5
```

MIT License, part of Pipelith.
