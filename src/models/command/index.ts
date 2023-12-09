import { UserInfo, userInfo } from 'os';
import { ChildProcess, spawn } from "child_process";
import { ICommand, runCommandArgsSchema, RunCommandStreams } from '../../definitions/ICommand';
import { commandDescriptorSchema, CommandParameter, ICommandDescriptor } from '../../definitions/ICommandDescriptor';
import { CommandStatus } from '../../definitions/CommandStatusEnum';
import { HistoryEntryType, IHistoryEntry } from '../../definitions/IHistoryEntry';
import { logger } from '../../utils/logger';
import { idGenerator } from '../../utils/idGenerator';
import { ProcessError, ValidationError } from '../../utils/errors';

/**
 * The command is instantiated by providing the command's descriptor object
 * to the contructor method.
 */
export class Command implements ICommand {
  // The command string
  private command: string;

  // The parameters given to the command
  private parameters: Array<CommandParameter>;

  // The command's description
  private description: string;

  // The alias given to the command
  private nameAlias: string;

  // The command process's PID
  private pid: number | undefined;

  // The command's current status
  private status: CommandStatus;

  // The user running the command
  private runAs: UserInfo<any>;

  // The command's exit code
  private exitCode: number | null;

  // Command's output
  private history: Array<IHistoryEntry>;

  // The instance of the command's process
  private childProcess: ChildProcess | null;

  // The datetime when the command was run (not instantiated)
  private startDate: Date | undefined;

  // The streams used for communication with the process
  private streams: RunCommandStreams;

  constructor(private readonly commandDescriptor: ICommandDescriptor, streams: RunCommandStreams) {
    if (!commandDescriptorSchema.safeParse(commandDescriptor).success) {
      logger.error('Cound not create command instance: command descriptor not provided', { data: JSON.stringify(commandDescriptor) });
      throw new ValidationError('Could not create command instance: command descriptor not provided', { data: JSON.stringify(commandDescriptor) });
    }

    if (!runCommandArgsSchema.safeParse(streams).success) {
      logger.error('Could not create command instance: IO streams not provided', { data: streams.toString() });
      throw new ValidationError('Could not create command instance: IO streams not provided', { data: streams.toString() });
    }

    this.streams = streams;
    this.nameAlias = this.commandDescriptor.nameAlias || idGenerator();
    logger.debug(`Creating command ${this.nameAlias}`);
    this.description = this.commandDescriptor.description || '';
    this.command = this.commandDescriptor.command;
    this.parameters = this.commandDescriptor.parameters || [];
    this.runAs = userInfo();
    this.status = CommandStatus.NOT_STARTED;
    this.history = [];
    this.childProcess = null;
    this.exitCode = null;
  }

  /**
   * Executes the command
   */
  public run(): void {
    const resolvedParameters = this.resolveCommandParameters(this.parameters);

    logger.debug(`Running command: ${ this.command } ${ resolvedParameters.join(' ') }`);

    this.startDate = new Date();

    try {
      this.childProcess = spawn(this.command, resolvedParameters, {
        cwd: process.cwd(),
        uid: this.runAs.uid,
        gid: this.runAs.gid,
      });

      this.pid = this.childProcess.pid;
      this.status = CommandStatus.RUNNING;

      this.eventsListener();
      this.registerIoEvent();
    } catch (err) {
      console.log(err);
      logger.error('A problem occurred when running the process', { data: { pid: this.pid, command: this.command } });
      throw new ProcessError('A problem occurred when running the process', { data: { pid: this.pid, command: this.command }.toString() }, err as Error);
    }
  }

  /**
   * Calls SIGTERM to terminate the process
   *
   * @returns void
   */
  public stop(): void {
    logger.debug(`Stopping command ${this.nameAlias}`);
    this.childProcess?.kill('SIGTERM');
  }

  /**
   * Calls SIGKILL to terminate the process
   *
   * @returns void
   */
  public kill(): void {
    logger.debug(`Killing command ${this.nameAlias}`);
    this.childProcess?.kill('SIGKILL');
  }

  /**
   * For checking whether the process is running
   *
   * @returns boolean
   */
  public isRunning(): boolean {
    return this.status == CommandStatus.RUNNING;
  }

  /**
   * Returns the current status of the process
   *
   * @returns `CommandStatus`
   */
  public getStatus(): CommandStatus {
    return this.status;
  }

  /**
   * Returns the command's parameters
   *
   * @returns Array<CommandParameter>
   */
  public getParameters(): Array<CommandParameter> {
    return this.parameters;
  }

  /**
   * Set the command's parameters
   *
   * This is used when the user answers parameters questions
   * All the parameters are reset in the prop
   *
   * @param parameters - Array<CommandParameter>
   * @returns void
   */
  public setParameters(parameters: Array<CommandParameter>): void {
    this.parameters = parameters;
  }

  /**
   * Returns the PID of the process
   *
   * @returns a number representing the PID or undefined if the process
   * didn't started yet
   */
  public getPid(): number | undefined {
    return this.pid;
  }

  /**
   * Returns the user running the command's process
   *
   * @returns UserInfo object
   */
  public getRunAs(): UserInfo<any> {
    return this.runAs;
  }

  /**
   * Returns the process exit code
   *
   * @returns the exit code's number or null, if not present
   */
  public getExitCode(): number | null {
    return this.exitCode;
  }

  /**
   * Returns the datetime of when the process _started_ (not when it got instantiated)
   *
   * @returns Date object
   */
  public getStartDate(): Date | undefined {
    return this.startDate;
  }

  /**
   * Gets the command's description
   *
   * @returns string
   */
  public getDescription(): string {
    return this.description;
  }

  /**
   * Returns the alias given to the command
   *
   * @returns string
   */
  public getNameAlias(): string {
    return this.nameAlias;
  }

  /**
   * Gets the string that composes the command
   *
   * @returns string
   */
  public getCommandString(): string {
    return this.command + this.parameters.join(' ');
  }

  /**
   * Provides a way to register a event listener for the process
   *
   * @returns any
   */
  public onEvent(event: string, listener: () => void): any {
    return this.childProcess?.addListener(event, listener);
  }

  /**
   * Removes all listeners the childProcess currently has
   *
   * @returns any
   */
  public removeAllEventListeners(event?: string): void {
    if (this.childProcess) {
      if (event) {
        this.childProcess.removeAllListeners(event);
      } else {
        const events = this.childProcess.eventNames();
        events.forEach((event) => this.childProcess?.removeAllListeners(event));
      }
    }
  }

  /**
   * Gets the process' history data
   *
   * @returns an array of IHistoryEntry
   */
  public getHistoryDump(): Array<IHistoryEntry> {
    return this.history;
  }

  /**
   * Makes sure the command receives the parameters that need user input
   *
   * In the list of parameters, there may be some 'input objects' among the strings
   * This method makes sure those are 'resolved'
   *
   * @returns Array<string>
   */
  private resolveCommandParameters(params: Array<CommandParameter>): Array<string> {
    return params.map((param) => {
      if (typeof param == 'string' ) {
        return param;
      }

      // gets the first '$' that is not escaped
      const replaceRule = new RegExp(/(?<!\\)\$/);

      // @TODO test to see if the answer is provided

      if (param.parameter.match(replaceRule)) {
        return param.parameter.replace(replaceRule, param.answer as string);
      }

      return param.answer as string;
    });
  }

  /**
   * Handles the process's status based on signals emmited by the process
   *
   * @returns void
   */
  private eventsListener(): void {
    this.childProcess?.on('exit', (code, signal) => {
      switch (signal) {
        case 'SIGKILL':
          this.status = CommandStatus.KILLED;
          break;
        case 'SIGTERM':
          this.status = CommandStatus.STOPPED;
          break;
        default:
          if (code && code > 0) {
            this.status = CommandStatus.ERROR;
          } else {
            this.status = CommandStatus.FINISHED;
          }
          break;
      }

      this.exitCode = code;
      logger.debug(`Command "${this.nameAlias}" is exiting ${signal ? 'by signal' + signal : '' } with code ${code}`);
    });

    this.childProcess?.on('error', (err) => {
      this.status = CommandStatus.STOPPED;
      // @TODO figure out about this error !== number thing
      // this.exitCode = code;
    logger.error(`Command ${this.nameAlias} stopped: ${err.message}`);
    });
  }

  /**
   * Registers events in the process's history
   *
   * @returns void
   */
  private registerIoEvent(): void {
    // @TODO when writing to streams I'm not checking for drainage but I'll do it later
    // [https://nodejs.org/docs/latest-v20.x/api/stream.html#writablewritechunk-encoding-callback]

    this.childProcess?.stdout?.on('data', (data: Buffer) => {
      this.streams.writeOutput.write(data)
      this.history.push({
        data: data.toString(),
        date: new Date(),
        type: HistoryEntryType.OUT
      });
    });

    this.childProcess?.stderr?.on('data', (data: Buffer) => {
      this.streams.writeError.write(data);
      this.history.push({
        data: data.toString(),
        date: new Date(),
        type: HistoryEntryType.ERR
      });
    });

    this.streams.readInput.on('data', (data: string) => {
      this.childProcess?.stdin?.write(data);
      this.history.push({
        data,
        date: new Date(),
        type: HistoryEntryType.IN
      });
    });
  }
}
