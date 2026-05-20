import atomicTask from './commands/atomic-task';
import domainMapper from './commands/domain-mapper';
import premortem from './commands/premortem';

export const commands = [atomicTask, premortem, domainMapper];
