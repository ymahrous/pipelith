`timescale 1ns / 1ps
`default_nettype none

// Eight 32-bit registers with two combinational read ports and one write port.
// A register written this cycle reads back its new value (write-through), so
// write-back and decode can share a cycle. r0..r7 expose the contents for
// waveform viewers.
module register_file (
  input  wire        clk,
  input  wire        reset,      // active low, synchronous
  input  wire [2:0]  ra,
  input  wire [2:0]  rb,
  output wire [31:0] rdata_a,
  output wire [31:0] rdata_b,
  input  wire        we,
  input  wire [2:0]  waddr,
  input  wire [31:0] wdata,
  output wire [31:0] r0,
  output wire [31:0] r1,
  output wire [31:0] r2,
  output wire [31:0] r3,
  output wire [31:0] r4,
  output wire [31:0] r5,
  output wire [31:0] r6,
  output wire [31:0] r7
);
  reg [31:0] regs [0:7];
  integer i;

  always @(posedge clk) begin
    if (!reset) begin
      for (i = 0; i < 8; i = i + 1) regs[i] <= 32'h00000000;
    end else if (we) begin
      regs[waddr] <= wdata;
    end
  end

  assign rdata_a = (we && waddr == ra) ? wdata : regs[ra];
  assign rdata_b = (we && waddr == rb) ? wdata : regs[rb];

  assign r0 = regs[0];
  assign r1 = regs[1];
  assign r2 = regs[2];
  assign r3 = regs[3];
  assign r4 = regs[4];
  assign r5 = regs[5];
  assign r6 = regs[6];
  assign r7 = regs[7];
endmodule

`default_nettype wire
