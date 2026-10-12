`timescale 1ns / 1ps
`default_nettype none
`include "isa_defs.vh"

// Turns one instruction (or the external-interrupt sequence) into micro-ops.
// Most instructions are a single micro-op. SWAP takes two, RTI two, INT three
// and the interrupt sequence two; `step` selects which one to produce.
module control_unit (
  input  wire [31:0]          instr,
  input  wire [1:0]           step,
  input  wire                 irq,        // replace the instruction with the interrupt sequence
  output reg  [`C_WIDTH-1:0]  ctrl,
  output reg  [2:0]           imm_sel,
  output reg                  last,       // this is the instruction's final micro-op
  output reg                  wait_mem,   // after it, fetch waits for the jump from MEM
  output reg                  two_word,   // the next word is this instruction's immediate
  output reg                  jump,       // JMP or CALL: fetch continues at the immediate
  output reg                  halt
);
  wire [4:0] opcode = instr[31:27];
  wire [2:0] rsrc1  = instr[26:24];
  wire [2:0] rsrc2  = instr[23:21];
  wire [2:0] rdst   = instr[20:18];

  always @* begin
    ctrl     = {`C_WIDTH{1'b0}};
    imm_sel  = `IMM_WORD;
    last     = 1'b1;
    wait_mem = 1'b0;
    two_word = 1'b0;
    jump     = 1'b0;
    halt     = 1'b0;
    ctrl[`C_VALID] = 1'b1;

    if (irq) begin
      // Push the address of the interrupted instruction, then jump through M[1].
      if (step == 2'd0) begin
        ctrl[`C_MEMOP]   = `MEM_PUSH;
        ctrl[`C_PUSHSRC] = `PUSH_CONST;
        imm_sel          = `IMM_PC;
        last             = 1'b0;
      end else begin
        ctrl[`C_MEMOP] = `MEM_VECTOR;
        imm_sel        = `IMM_EXTVEC;
        wait_mem       = 1'b1;
      end
    end else begin
      case (opcode)
        `OP_HLT:  halt = 1'b1;
        `OP_SETC: ctrl[`C_SETC] = 1'b1;
        `OP_NOT, `OP_INC: begin
          ctrl[`C_USEA]     = 1'b1;
          ctrl[`C_AREG]     = rdst;
          ctrl[`C_ALU]      = (opcode == `OP_NOT) ? `ALU_NOT : `ALU_INC;
          ctrl[`C_REGWRITE] = 1'b1;
          ctrl[`C_DEST]     = rdst;
          ctrl[`C_FLAGS_ZN] = 1'b1;
          ctrl[`C_FLAGS_C]  = (opcode == `OP_INC);
        end
        `OP_OUT: begin
          ctrl[`C_USEA] = 1'b1;
          ctrl[`C_AREG] = rsrc1;
          ctrl[`C_ALU]  = `ALU_PASS_A;
          ctrl[`C_OUT]  = 1'b1;
        end
        `OP_IN: begin
          ctrl[`C_ALU]      = `ALU_PASS_IN;
          ctrl[`C_REGWRITE] = 1'b1;
          ctrl[`C_DEST]     = rdst;
        end
        `OP_MOV: begin
          ctrl[`C_USEA]     = 1'b1;
          ctrl[`C_AREG]     = rsrc1;
          ctrl[`C_ALU]      = `ALU_PASS_A;
          ctrl[`C_REGWRITE] = 1'b1;
          ctrl[`C_DEST]     = rdst;
        end
        `OP_SWAP: begin
          if (step == 2'd0) begin
            // Rdst <- Rsrc; the old Rdst travels along as B for the second micro-op.
            ctrl[`C_USEA]     = 1'b1;
            ctrl[`C_AREG]     = rsrc1;
            ctrl[`C_USEB]     = 1'b1;
            ctrl[`C_BREG]     = rdst;
            ctrl[`C_ALU]      = `ALU_PASS_A;
            ctrl[`C_REGWRITE] = 1'b1;
            ctrl[`C_DEST]     = rdst;
            last              = 1'b0;
          end else begin
            // Rsrc <- old Rdst, taken from the first micro-op one stage ahead.
            ctrl[`C_ALU]      = `ALU_SWAP;
            ctrl[`C_REGWRITE] = 1'b1;
            ctrl[`C_DEST]     = rsrc1;
          end
        end
        `OP_ADD, `OP_SUB, `OP_AND: begin
          ctrl[`C_USEA]     = 1'b1;
          ctrl[`C_AREG]     = rsrc1;
          ctrl[`C_USEB]     = 1'b1;
          ctrl[`C_BREG]     = rsrc2;
          ctrl[`C_ALU]      = (opcode == `OP_ADD) ? `ALU_ADD : (opcode == `OP_SUB) ? `ALU_SUB : `ALU_AND;
          ctrl[`C_REGWRITE] = 1'b1;
          ctrl[`C_DEST]     = rdst;
          ctrl[`C_FLAGS_ZN] = 1'b1;
          ctrl[`C_FLAGS_C]  = (opcode != `OP_AND);
        end
        `OP_PUSH: begin
          ctrl[`C_USEA]    = 1'b1;
          ctrl[`C_AREG]    = rsrc1;
          ctrl[`C_ALU]     = `ALU_PASS_A;
          ctrl[`C_MEMOP]   = `MEM_PUSH;
          ctrl[`C_PUSHSRC] = `PUSH_A;
        end
        `OP_POP: begin
          ctrl[`C_MEMOP]    = `MEM_POP;
          ctrl[`C_POPDST]   = `POP_REG;
          ctrl[`C_REGWRITE] = 1'b1;
          ctrl[`C_DEST]     = rdst;
          ctrl[`C_WBMEM]    = 1'b1;
        end
        `OP_LDM: begin
          two_word          = 1'b1;
          ctrl[`C_ALU]      = `ALU_PASS_IMM;
          ctrl[`C_REGWRITE] = 1'b1;
          ctrl[`C_DEST]     = rdst;
        end
        `OP_LDD: begin
          two_word          = 1'b1;
          ctrl[`C_USEA]     = 1'b1;
          ctrl[`C_AREG]     = rsrc1;
          ctrl[`C_ALU]      = `ALU_ADD_IMM;
          ctrl[`C_MEMOP]    = `MEM_LOAD;
          ctrl[`C_REGWRITE] = 1'b1;
          ctrl[`C_DEST]     = rdst;
          ctrl[`C_WBMEM]    = 1'b1;
        end
        `OP_STD: begin
          two_word       = 1'b1;
          ctrl[`C_USEA]  = 1'b1;
          ctrl[`C_AREG]  = rsrc1;
          ctrl[`C_USEB]  = 1'b1;
          ctrl[`C_BREG]  = rsrc2;
          ctrl[`C_ALU]   = `ALU_ADD_IMM;
          ctrl[`C_MEMOP] = `MEM_STORE;
        end
        `OP_IADD: begin
          two_word          = 1'b1;
          ctrl[`C_USEA]     = 1'b1;
          ctrl[`C_AREG]     = rsrc1;
          ctrl[`C_ALU]      = `ALU_ADD_IMM;
          ctrl[`C_REGWRITE] = 1'b1;
          ctrl[`C_DEST]     = rdst;
          ctrl[`C_FLAGS_ZN] = 1'b1;
          ctrl[`C_FLAGS_C]  = 1'b1;
        end
        `OP_JZ, `OP_JN, `OP_JC: begin
          two_word        = 1'b1;
          ctrl[`C_BRANCH] = (opcode == `OP_JZ) ? `BR_JZ : (opcode == `OP_JN) ? `BR_JN : `BR_JC;
        end
        `OP_JMP: begin
          two_word = 1'b1;
          jump     = 1'b1;
        end
        `OP_CALL: begin
          two_word         = 1'b1;
          jump             = 1'b1;
          ctrl[`C_MEMOP]   = `MEM_PUSH;
          ctrl[`C_PUSHSRC] = `PUSH_CONST;
          imm_sel          = `IMM_PC2;
        end
        `OP_RET: begin
          ctrl[`C_MEMOP]  = `MEM_POP;
          ctrl[`C_POPDST] = `POP_PC;
          wait_mem        = 1'b1;
        end
        `OP_INT: begin
          case (step)
            2'd0: begin
              ctrl[`C_MEMOP]   = `MEM_PUSH;
              ctrl[`C_PUSHSRC] = `PUSH_CONST;
              imm_sel          = `IMM_PC1;
              last             = 1'b0;
            end
            2'd1: begin
              ctrl[`C_MEMOP]   = `MEM_PUSH;
              ctrl[`C_PUSHSRC] = `PUSH_FLAGS;
              last             = 1'b0;
            end
            default: begin
              ctrl[`C_MEMOP] = `MEM_VECTOR;
              imm_sel        = `IMM_INTVEC;
              wait_mem       = 1'b1;
            end
          endcase
        end
        `OP_RTI: begin
          if (step == 2'd0) begin
            ctrl[`C_MEMOP]  = `MEM_POP;
            ctrl[`C_POPDST] = `POP_FLAGS;
            last            = 1'b0;
          end else begin
            ctrl[`C_MEMOP]  = `MEM_POP;
            ctrl[`C_POPDST] = `POP_PC;
            wait_mem        = 1'b1;
          end
        end
        default: ;  // NOP and undefined opcodes do nothing
      endcase
    end
  end
endmodule

`default_nettype wire
