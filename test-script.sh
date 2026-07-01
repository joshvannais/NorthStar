#!/bin/bash
echo "Script is running" > /home/agent-lead/northstar-solutions/script-output.txt
whoami >> /home/agent-lead/northstar-solutions/script-output.txt
ls /home/agent-lead/ >> /home/agent-lead/northstar-solutions/script-output.txt
echo "Node: $(node --version)" >> /home/agent-lead/northstar-solutions/script-output.txt
echo "DONE" >> /home/agent-lead/northstar-solutions/script-output.txt