`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.vh"

// Decode: turns the instruction in IF/ID into micro-ops, reads the register
// file and decides whether fetch may continue.
//  - Two-word instructions take their immediate straight from the memory bus
//    in the cycle it is fetched; if MEM holds the port, decode waits.
//  - Multi-micro-op instructions (SWAP, INT, RTI) keep the instruction in
//    IF/ID until their last micro-op has issued.
//  - RET, RTI, INT and interrupts stop fetch until MEM supplies the new PC.
//  - HLT stops fetch until reset.
module decode_stage (
  input  wire                clk,
  input  wire                reset,          // active low, synchronous
  input  wire                valid_in,
  input  wire [31:0]         instr_in,
  input  wire [31:0]         pc_in,
  input  wire [31:0]         in_val_in,
  input  wire [31:0]         fetch_word,
  input  wire                fetch_free,
  input  wire                flush,          // a jump from EX or MEM: this instruction is on the wrong path
  input  wire                mem_jump,
  input  wire                irq_pending,
  input  wire                hazard_stall,
  input  wire [31:0]         rdata_a,
  input  wire [31:0]         rdata_b,
  output wire [2:0]          ra,
  output wire [2:0]          rb,
  output wire [`C_WIDTH-1:0] uop,            // the micro-op being decoded, for the hazard unit
  output wire [`C_WIDTH-1:0] ctrl_out,       // the micro-op issued to EX (zero: bubble)
  output wire [31:0]         pc_out,
  output wire [31:0]         a_out,
  output wire [31:0]         b_out,
  output reg  [31:0]         imm_out,
  output wire [31:0]         in_val_out,
  output wire                hold,
  output wire                consume_imm,
  output wire                jump,
  output wire [31:0]         jump_target,
  output wire                fetch_stop,
  output wire                irq_taken
);
  reg [1:0] step;
  reg       irq_mode;
  reg       halted;
  reg       waiting;

  wire take_irq = irq_pending && step == 2'd0;
  wire irq_now  = (step == 2'd0) ? take_irq : irq_mode;

  wire [2:0] imm_sel;
  wire       last;
  wire       wait_mem;
  wire       two_word;
  wire       is_jump;
  wire       halt;

  control_unit u_control (
    .instr(instr_in), .step(step), .irq(irq_now),
    .ctrl(uop), .imm_sel(imm_sel), .last(last), .wait_mem(wait_mem),
    .two_word(two_word), .jump(is_jump), .halt(halt)
  );

  wire active   = valid_in && !halted && !waiting && !flush;
  wire need_imm = two_word && !irq_now;
  wire stall    = hazard_stall || (need_imm && !fetch_free);
  wire issue    = active && !stall;
  wire done     = issue && last;

  assign ra          = uop[`C_AREG];
  assign rb          = uop[`C_BREG];
  assign ctrl_out    = issue ? uop : {`C_WIDTH{1'b0}};
  assign pc_out      = pc_in;
  assign a_out       = rdata_a;
  assign b_out       = rdata_b;
  assign in_val_out  = in_val_in;
  assign hold        = active && !done;
  assign consume_imm = issue && need_imm;
  assign jump        = issue && is_jump && !irq_now;
  assign jump_target = fetch_word;
  assign fetch_stop  = halted || waiting || (done && (halt || wait_mem));
  assign irq_taken   = issue && step == 2'd0 && take_irq;

  always @* begin
    case (imm_sel)
      `IMM_PC1:    imm_out = pc_in + 32'd1;
      `IMM_PC2:    imm_out = pc_in + 32'd2;
      `IMM_PC:     imm_out = pc_in;
      `IMM_INTVEC: imm_out = 32'd2 + {30'd0, instr_in[17:16]};
      `IMM_EXTVEC: imm_out = 32'd1;
      default:     imm_out = fetch_word;
    endcase
  end

  always @(posedge clk) begin
    if (!reset) begin
      step     <= 2'd0;
      irq_mode <= 1'b0;
      halted   <= 1'b0;
      waiting  <= 1'b0;
    end else begin
      if (mem_jump) waiting <= 1'b0;
      if (flush) begin
        step     <= 2'd0;
        irq_mode <= 1'b0;
      end else if (issue) begin
        if (last) begin
          step     <= 2'd0;
          irq_mode <= 1'b0;
          if (halt) halted <= 1'b1;
          if (wait_mem) waiting <= 1'b1;
        end else begin
          step <= step + 2'd1;
          if (step == 2'd0) irq_mode <= take_irq;
        end
      end
    end
  end
endmodule

`default_nettype wire
