`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.svh"

// ID/EX: the micro-op's control word, its operands as read in decode, the
// immediate and the IN-port value.
module id_ex_register (
  input  logic                clk,
  input  logic                reset,      // active low, synchronous
  input  logic                stall,
  input  logic                flush,
  input  logic [`C_WIDTH-1:0] ctrl_in,
  input  logic [31:0]         pc_in,
  input  logic [31:0]         a_in,
  input  logic [31:0]         b_in,
  input  logic [31:0]         imm_in,
  input  logic [31:0]         in_val_in,
  output logic [`C_WIDTH-1:0] ctrl_out,
  output logic [31:0]         pc_out,
  output logic [31:0]         a_out,
  output logic [31:0]         b_out,
  output logic [31:0]         imm_out,
  output logic [31:0]         in_val_out
);
  always_ff @(posedge clk) begin
    if (!reset || flush) begin
      ctrl_out   <= {`C_WIDTH{1'b0}};
      pc_out     <= 32'h00000000;
      a_out      <= 32'h00000000;
      b_out      <= 32'h00000000;
      imm_out    <= 32'h00000000;
      in_val_out <= 32'h00000000;
    end else if (!stall) begin
      ctrl_out   <= ctrl_in;
      pc_out     <= pc_in;
      a_out      <= a_in;
      b_out      <= b_in;
      imm_out    <= imm_in;
      in_val_out <= in_val_in;
    end
  end
endmodule

`default_nettype wire
