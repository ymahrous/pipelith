`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.vh"

// Execute: forwarding muxes, the ALU, the condition code register and
// conditional branches. Branches read the flags here, so a flag set by the
// instruction just ahead is already in the register when they need it.
module execute_stage (
  input  wire                clk,
  input  wire                reset,          // active low, synchronous
  input  wire [`C_WIDTH-1:0] ctrl_in,
  input  wire [31:0]         a_in,
  input  wire [31:0]         b_in,
  input  wire [31:0]         imm_in,
  input  wire [31:0]         in_val_in,
  input  wire [1:0]          fwd_a,
  input  wire [1:0]          fwd_b,
  input  wire [31:0]         ex_mem_result,  // forwarding path from EX/MEM
  input  wire [31:0]         ex_mem_data,    // old Rdst carried by SWAP's first micro-op
  input  wire [31:0]         mem_wb_result,  // forwarding path from MEM/WB
  input  wire                flags_we,       // RTI restores the flags in MEM
  input  wire [2:0]          flags_in,
  output wire [31:0]         result_out,
  output wire [31:0]         data_out,
  output reg  [2:0]          ccr,
  output wire                jump,
  output wire [31:0]         jump_target
);
  wire       valid   = ctrl_in[`C_VALID];
  wire [1:0] branch  = ctrl_in[`C_BRANCH];
  wire [2:0] memop   = ctrl_in[`C_MEMOP];
  wire [1:0] pushsrc = ctrl_in[`C_PUSHSRC];

  wire [31:0] a = (fwd_a == 2'b01) ? ex_mem_result : (fwd_a == 2'b10) ? mem_wb_result : a_in;
  wire [31:0] b = (fwd_b == 2'b01) ? ex_mem_result : (fwd_b == 2'b10) ? mem_wb_result : b_in;

  wire carry;
  alu u_alu (
    .op(ctrl_in[`C_ALU]), .a(a), .b(b), .imm(imm_in), .in_val(in_val_in),
    .swap_val(ex_mem_data), .result(result_out), .carry(carry)
  );

  wire zero  = (result_out == 32'h00000000);
  wire neg   = result_out[31];
  wire taken = valid && ((branch == `BR_JZ && ccr[`FLAG_Z]) ||
                         (branch == `BR_JN && ccr[`FLAG_N]) ||
                         (branch == `BR_JC && ccr[`FLAG_C]));

  assign jump        = taken;
  assign jump_target = imm_in;
  assign data_out    = (memop != `MEM_PUSH)       ? b :
                       (pushsrc == `PUSH_CONST)   ? imm_in :
                       (pushsrc == `PUSH_FLAGS)   ? {29'd0, ccr} : a;

  always @(posedge clk) begin
    if (!reset) begin
      ccr <= 3'b000;
    end else if (flags_we) begin
      ccr <= flags_in;
    end else if (valid) begin
      if (ctrl_in[`C_SETC]) ccr[`FLAG_C] <= 1'b1;
      if (ctrl_in[`C_FLAGS_ZN]) begin
        ccr[`FLAG_Z] <= zero;
        ccr[`FLAG_N] <= neg;
      end
      if (ctrl_in[`C_FLAGS_C]) ccr[`FLAG_C] <= carry;
      // A taken conditional branch clears the flag it tested.
      if (taken) begin
        case (branch)
          `BR_JZ:  ccr[`FLAG_Z] <= 1'b0;
          `BR_JN:  ccr[`FLAG_N] <= 1'b0;
          default: ccr[`FLAG_C] <= 1'b0;
        endcase
      end
    end
  end
endmodule

`default_nettype wire
