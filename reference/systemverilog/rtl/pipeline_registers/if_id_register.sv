`timescale 1ns / 1ps
`default_nettype none

// IF/ID: the fetched instruction word, its address and the IN-port value
// sampled when it was fetched. stall keeps the contents; flush inserts a bubble.
module if_id_register (
  input  logic        clk,
  input  logic        reset,      // active low, synchronous
  input  logic        stall,
  input  logic        flush,
  input  logic        valid_in,
  input  logic [31:0] instr_in,
  input  logic [31:0] pc_in,
  input  logic [31:0] in_val_in,
  output logic        valid_out,
  output logic [31:0] instr_out,
  output logic [31:0] pc_out,
  output logic [31:0] in_val_out
);
  always_ff @(posedge clk) begin
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
