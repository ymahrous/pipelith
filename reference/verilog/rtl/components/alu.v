`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.vh"

// Arithmetic and logic unit. Zero and negative are derived from the result by
// the execute stage; carry is produced here.
module alu (
  input  wire [3:0]  op,
  input  wire [31:0] a,
  input  wire [31:0] b,
  input  wire [31:0] imm,
  input  wire [31:0] in_val,
  input  wire [31:0] swap_val,
  output reg  [31:0] result,
  output reg         carry
);
  reg [32:0] wide;

  always @* begin
    wide   = 33'd0;
    result = 32'h00000000;
    carry  = 1'b0;
    case (op)
      `ALU_PASS_A:   result = a;
      `ALU_NOT:      result = ~a;
      `ALU_INC: begin
        wide   = {1'b0, a} + 33'd1;
        result = wide[31:0];
        carry  = wide[32];
      end
      `ALU_ADD: begin
        wide   = {1'b0, a} + {1'b0, b};
        result = wide[31:0];
        carry  = wide[32];
      end
      `ALU_SUB: begin
        result = a - b;
        carry  = (a >= b);   // carry means "no borrow"
      end
      `ALU_AND:      result = a & b;
      `ALU_ADD_IMM: begin
        wide   = {1'b0, a} + {1'b0, imm};
        result = wide[31:0];
        carry  = wide[32];
      end
      `ALU_PASS_IMM: result = imm;
      `ALU_PASS_IN:  result = in_val;
      `ALU_SWAP:     result = swap_val;
      default:       result = 32'h00000000;
    endcase
  end
endmodule

`default_nettype wire
