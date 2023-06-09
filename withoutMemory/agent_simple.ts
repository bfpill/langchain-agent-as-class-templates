import { LLMChain } from "langchain/chains";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { AgentExecutor, AgentActionOutputParser, LLMSingleActionAgent, BaseSingleActionAgent } from "langchain/agents";
import { DynamicTool, Tool } from "langchain/tools";
import {
    BaseChatPromptTemplate,
    BasePromptTemplate,
    SerializedBasePromptTemplate,
    renderTemplate,
} from "langchain/prompts";

import { AgentAction, AgentFinish, AgentStep, BaseChatMessage, HumanChatMessage, InputValues, PartialValues } from "langchain/schema";

const printHelloWorld = async () => {
    //replace with you custom tool logic / API calls, etc
    const helloWorld = "Hello World";
    try {
        return ("Compiled Code: " + helloWorld)
    }
    catch (error) {
        return ("Could not connect to server")
    }
}

const getTodaysWeather = async (agentInput: string) => {
    //replace with you custom tool logic / API calls, etc
    try {
        const todaysWeather = parseInt(agentInput) * 10 + "degrees farenheit."
        return ("Todays weather " + todaysWeather)
    }
    catch (error) {
        return ("Could not get todays weather. Make sure your input is correctly formatted and try again. ")
    }
}

const PREFIX = `Answer the following questions as best you can. You have access to the following tools:`;


//Change the prompt as you need, but be careful.
//The consitency of the LLM successfully using its tool is highly dependent on the Prompt and tool descriptions
const formatInstructions = (
    toolNames: string
) => `Use the following format in your response:

Question: the input question you must answer
Thought: you should always think about what to do
Action: the action to take, should be one of [${toolNames}]
Action Input: the input to the action
Observation: the result of the action
... (this Thought/Action/Action Input/Observation can repeat N times)
Thought: I now know the final answer
Final Answer: the final answer to the original input question`;
const SUFFIX = `Begin!

Question: {input}
Thought:{agent_scratchpad}`;

class CustomPromptTemplate extends BaseChatPromptTemplate {
    tools: Tool[];

    constructor(args: { tools: Tool[]; inputVariables: string[] }) {
        super({ inputVariables: args.inputVariables });
        this.tools = args.tools;
    }

    _getPromptType(): string {
        throw new Error("Not implemented");
    }

    async formatMessages(values: InputValues): Promise<BaseChatMessage[]> {
        if (values.intermediate_steps.length >= 1) {
            console.log(values.intermediate_steps[values.intermediate_steps.length - 1].action.toolInput 
                + " : " + values.intermediate_steps[values.intermediate_steps.length - 1].observation);
        }
        /** Construct the final template */
        const toolStrings = this.tools
            .map((tool) => `${tool.name}: ${tool.description}`)
            .join("\n");
        const toolNames = this.tools.map((tool) => tool.name).join("\n");
        const instructions = formatInstructions(toolNames);
        const template = [PREFIX, toolStrings, instructions, SUFFIX].join("\n\n");
        /** Construct the agent_scratchpad */
        const intermediateSteps = values.intermediate_steps as AgentStep[];
        const agentScratchpad = intermediateSteps.reduce(
            (thoughts, { action, observation }) =>
                thoughts +
                [action.log, `\nObservation: ${observation}`, "Thought:"].join("\n"),
            ""
        );
        const newInput = { agent_scratchpad: agentScratchpad, ...values };
        /** Format the template. */
        const formatted = renderTemplate(template, "f-string", newInput);
        return [new HumanChatMessage(formatted)];
    }

    partial(_values: PartialValues): Promise<BasePromptTemplate> {
        throw new Error("Not implemented");
    }

    serialize(): SerializedBasePromptTemplate {
        throw new Error("Not implemented");
    }
}

class CustomOutputParser extends AgentActionOutputParser {
    async parse(text: string): Promise<AgentAction | AgentFinish> {
        console.log(text);
        if (text.includes("Final Answer:")) {
            const parts = text.split("Final Answer:");
            const input = parts[parts.length - 1].trim();
            const finalAnswers = { output: input };
            return { log: text, returnValues: finalAnswers };
        }

        const match = /Action: (.*)\nAction Input:(.*)/s.exec(text);
        if (!match) {
            throw new Error(`Could not parse LLM output: ${text}`);
        }

        return {
            tool: match[1].trim(),
            toolInput: match[2].trim().replace(/^"+|"+$/g, ""),
            log: text,
        };
    }

    getFormatInstructions(): string {
        throw new Error("Not implemented");
    }
}

export default class Agent {
    tools: Tool[];
    prompt: BaseChatPromptTemplate;
    chain: LLMChain;
    agent: BaseSingleActionAgent;
    executor: AgentExecutor;

    constructor(key: string) {
        this.tools = this.createTools();
        this.prompt = this.createPrompt(this.tools);
        this.chain = this.createChain(this.prompt);
        this.agent = this.createAgent(this.chain);
        this.executor = this.createExecutor(this.agent, this.tools);
    }

    createTools = () => {
        const tools = [
            new DynamicTool({
                name: "[HelloWorldPrinter]",
                description:
                    `Use this to print Hello world to the user console.`,
                func: async () => await printHelloWorld(),
            }),
            new DynamicTool({
                name: "[TodaysWeatherGetter]",
                // Be careful not to overlap with the customOutputParser when describing the tools!!
                description:
                    `Use this to get todays weather. You must input just the number date of the day of the month, 
                    for example if today was May 30th, you would input 30. 
          
                Do NOT include the number in your Action, only your ActionInput`,
                func: async (agentInput) => await getTodaysWeather(agentInput),
            }),
        ]
        return tools;
    }

    createPrompt = (tools: Tool[]) => {
        const prompt = new CustomPromptTemplate({
            tools,
            inputVariables: ["input", "agent_scratchpad"], 
        })
        return prompt;
    }

    private createChain = (prompt: BasePromptTemplate) => {
        const chat = new ChatOpenAI({});

        const llmChain = new LLMChain({
            prompt: prompt,
            llm: chat,
        });

        return llmChain;
    }

    private createAgent = (llmChain: LLMChain<string>) => {
        const agent = new LLMSingleActionAgent({
            outputParser: new CustomOutputParser(),
            llmChain,
            stop: ["\nObservation"],
        });

        return agent;
    }

    private createExecutor = (agent: BaseSingleActionAgent, tools: Tool[]) => {
        const executor = AgentExecutor.fromAgentAndTools({ agent, tools });
        return executor;
    }

    run = async (input: string) => {
        const response = await this.executor.call({ input });
        console.log(response);
        return response;
    }
};
