`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.vh"

// MEM/WB: the control word, the ALU result and the word read from memory.
module mem_wb_register (
  input  wire                clk,
  input  wire                reset,      // active low, synchronous
  input  wire                stall,
  input  wire                flush,
  input  wire [`C_WIDTH-1:0] ctrl_in,
  input  wire [31:0]         pc_in,
  input  wire [31:0]         result_in,
  input  wire [31:0]         mem_data_in,
  output reg  [`C_WIDTH-1:0] ctrl_out,
  output reg  [31:0]         pc_out,
  output reg  [31:0]         result_out,
  output reg  [31:0]         mem_data_out
);
  always @(posedge clk) begin
    if (!reset || flush) begin
      ctrl_out     <= {`C_WIDTH{1'b0}};
      pc_out       <= 32'h00000000;
      result_out   <= 32'h00000000;
      mem_data_out <= 32'h00000000;
    end else if (!stall) begin
      ctrl_out     <= ctrl_in;
      pc_out       <= pc_in;
      result_out   <= result_in;
      mem_data_out <= mem_data_in;
    end
  end
endmodule

`default_nettype wire
