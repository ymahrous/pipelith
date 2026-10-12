`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.vh"

// EX/MEM: the control word, the ALU result (also the load/store address), the
// data to store or push, and the immediate (the vector address of INT).
module ex_mem_register (
  input  wire                clk,
  input  wire                reset,      // active low, synchronous
  input  wire                stall,
  input  wire                flush,
  input  wire [`C_WIDTH-1:0] ctrl_in,
  input  wire [31:0]         pc_in,
  input  wire [31:0]         result_in,
  input  wire [31:0]         data_in,
  input  wire [31:0]         imm_in,
  output reg  [`C_WIDTH-1:0] ctrl_out,
  output reg  [31:0]         pc_out,
  output reg  [31:0]         result_out,
  output reg  [31:0]         data_out,
  output reg  [31:0]         imm_out
);
  always @(posedge clk) begin
    if (!reset || flush) begin
      ctrl_out   <= {`C_WIDTH{1'b0}};
      pc_out     <= 32'h00000000;
      result_out <= 32'h00000000;
      data_out   <= 32'h00000000;
      imm_out    <= 32'h00000000;
    end else if (!stall) begin
      ctrl_out   <= ctrl_in;
      pc_out     <= pc_in;
      result_out <= result_in;
      data_out   <= data_in;
      imm_out    <= imm_in;
    end
  end
endmodule

`default_nettype wire
