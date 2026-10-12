`timescale 1ns / 1ps
`default_nettype none

// IF/ID: the fetched instruction word, its address and the IN-port value
// sampled when it was fetched. stall keeps the contents; flush inserts a bubble.
module if_id_register (
  input  wire        clk,
  input  wire        reset,      // active low, synchronous
  input  wire        stall,
  input  wire        flush,
  input  wire        valid_in,
  input  wire [31:0] instr_in,
  input  wire [31:0] pc_in,
  input  wire [31:0] in_val_in,
  output reg         valid_out,
  output reg  [31:0] instr_out,
  output reg  [31:0] pc_out,
  output reg  [31:0] in_val_out
);
  always @(posedge clk) begin
    if (!reset || flush) begin
      valid_out  <= 1'b0;
      instr_out  <= 32'h00000000;
      pc_out     <= 32'h00000000;
      in_val_out <= 32'h00000000;
    end else if (!stall) begin
      valid_out  <= valid_in;
      instr_out  <= instr_in;
      pc_out     <= pc_in;
      in_val_out <= in_val_in;
    end
  end
endmodule

`default_nettype wire
