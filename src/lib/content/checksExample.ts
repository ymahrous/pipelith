/** The worked example on /docs/checks. A unit test runs it: every check must pass. */
export const CHECKS_EXAMPLE = `.ORG 0
10                 # reset vector: start at 0x10
.ORG 10
IN   R1            #R1=30          (also sets the IN port to 30)
LDM  R2, 5         #R2=5
ADD  R3, R1, R2    #R3=35, Z = 0, C --> 0
PUSH R3            #SP=FFE, M[FFF]=35
JZ   40            #not taken
NOT  R3            #R3=FFFF_FFCA, N=1, C --> no change
JMP  30            #taken
SETC               #this statement shouldn't be executed
.ORG 30
HLT`;
