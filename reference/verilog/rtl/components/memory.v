`timescale 1ns / 1ps
`default_nettype none

// Unified instruction and data memory (Von Neumann): 4096 words of 32 bits
// behind a single port. Reads are combinational, writes happen on the rising
// edge. Addresses outside the memory read as 0 and ignore writes.
module memory #(
  parameter MEM_FILE = "program.mem"
) (
  input  wire        clk,
  input  wire [31:0] addr,
  input  wire        we,
  input  wire [31:0] wdata,
  output wire [31:0] rdata
);
  localparam WORDS = 4096;

  reg [31:0] ram [0:WORDS-1];
  integer i;

  initial begin
    for (i = 0; i < WORDS; i = i + 1) ram[i] = 32'h00000000;
    $readmemb(MEM_FILE, ram);
  end

  wire in_range = addr < WORDS;

  assign rdata = in_range ? ram[addr[11:0]] : 32'h00000000;

  // $readmemb also writes ram, so this stays a plain always (not always_ff) in SystemVerilog.
  always @(posedge clk) begin
    if (we && in_range) ram[addr[11:0]] <= wdata;
  end
endmodule

`default_nettype wire
