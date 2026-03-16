/**
 * 辅助工具：检查和管理工作空间中的 .tasks 目录
 */

import { ipcBridge } from '@/common';
import type { IDirOrFile } from '@/common/ipcBridge';

/**
 * 检查工作空间中是否存在 .tasks 目录
 * @param workspacePath 工作空间路径
 * @returns 如果存在 .tasks 目录则返回 true，否则返回 false
 */
export async function checkTasksDirectory(workspacePath: string): Promise<boolean> {
  // 先验证路径是否有效
  if (!workspacePath || typeof workspacePath !== 'string') {
    console.error('Invalid workspace path provided:', workspacePath);
    return false;
  }

  try {
    // 检查工作空间根目录下是否有 .tasks 目录
    const workspaceFiles = await ipcBridge.conversation.getWorkspace.invoke({
      path: workspacePath,
      workspace: workspacePath,
      conversation_id: '', // 空 ID，因为我们只需要文件结构
      search: ''
    });

    // 检查是否有名为 .tasks 的目录
    const tasksDir = workspaceFiles.find(item => item.name === '.tasks' && item.isDir);
    return !!tasksDir;
  } catch (error) {
    console.error('Error checking .tasks directory:', error);
    return false;
  }
}

/**
 * 检查 .tasks 目录中是否有有效的 DAG JSON 文件
 * @param workspacePath 工作空间路径
 * @returns 包含 DAG 文件数量的对象
 */
export async function checkDagFiles(workspacePath: string): Promise<{ exists: boolean; dagCount: number; dagPaths: string[] }> {
  // 先验证路径是否有效
  if (!workspacePath || typeof workspacePath !== 'string') {
    console.error('Invalid workspace path provided:', workspacePath);
    return { exists: false, dagCount: 0, dagPaths: [] };
  }

  try {
    // 获取 .tasks 目录内容
    const tasksDirPath = `${workspacePath}/.tasks`;
    const tasksFiles = await ipcBridge.conversation.getWorkspace.invoke({
      path: tasksDirPath,
      workspace: workspacePath,
      conversation_id: '',
      search: ''
    });

    if (tasksFiles.length === 0) {
      return { exists: false, dagCount: 0, dagPaths: [] };
    }

    const dagPaths: string[] = [];

    // 遍历 .tasks 目录中的子目录
    for (const item of tasksFiles) {
      if (item.isDir && item.name.startsWith('dag_')) {
        // 检查子目录中是否有匹配的 JSON 文件
        const dagSubDirPath = `${workspacePath}/.tasks/${item.name}`;
        const dagSubDirFiles = await ipcBridge.conversation.getWorkspace.invoke({
          path: dagSubDirPath,
          workspace: workspacePath,
          conversation_id: '',
          search: ''
        });

        // 查找以 dag_ 开头并以 .json 结尾的文件
        for (const subItem of dagSubDirFiles) {
          if (subItem.isFile && subItem.name.startsWith('dag_') && subItem.name.endsWith('.json')) {
            dagPaths.push(subItem.fullPath);
          }
        }
      }
    }

    return { exists: true, dagCount: dagPaths.length, dagPaths };
  } catch (error) {
    console.error('Error checking DAG files:', error);
    return { exists: false, dagCount: 0, dagPaths: [] };
  }
}

/**
 * 创建 .tasks 目录
 * @param workspacePath 工作空间路径
 * @returns 成功返回 true，失败返回 false
 */
export async function createTasksDirectory(workspacePath: string): Promise<boolean> {
  // 先验证路径是否有效
  if (!workspacePath || typeof workspacePath !== 'string') {
    console.error('Invalid workspace path provided:', workspacePath);
    return false;
  }

  try {
    const tasksDirPath = `${workspacePath}/.tasks`;
    await ipcBridge.fs.createDir.invoke({ path: tasksDirPath });
    console.log(`Created .tasks directory at: ${tasksDirPath}`);
    return true;
  } catch (error) {
    console.error('Error creating .tasks directory:', error);
    return false;
  }
}

/**
 * 确保工作空间中有 .tasks 目录
 * @param workspacePath 工作空间路径
 * @returns 如果 .tasks 目录存在或成功创建则返回 true
 */
export async function ensureTasksDirectory(workspacePath: string): Promise<boolean> {
  // 先验证路径是否有效
  if (!workspacePath || typeof workspacePath !== 'string') {
    console.error('Invalid workspace path provided for ensureTasksDirectory:', workspacePath);
    return false;
  }

  const exists = await checkTasksDirectory(workspacePath);

  if (!exists) {
    console.log(`.tasks directory not found in workspace: ${workspacePath}, creating it...`);
    return await createTasksDirectory(workspacePath);
  }

  console.log('.tasks directory already exists');
  return true;
}

/**
 * 生成示例 DAG 文件
 * @param workspacePath 工作空间路径
 * @returns 成功返回 true，失败返回 false
 */
export async function createSampleDagFile(workspacePath: string): Promise<boolean> {
  // 先验证路径是否有效
  if (!workspacePath || typeof workspacePath !== 'string') {
    console.error('Invalid workspace path provided for createSampleDagFile:', workspacePath);
    return false;
  }

  try {
    // 首先确保 .tasks 目录存在
    const tasksDirExists = await ensureTasksDirectory(workspacePath);
    if (!tasksDirExists) {
      console.error('Cannot create sample DAG file: failed to create .tasks directory');
      return false;
    }

    // 创建示例 DAG 目录
    const dagId = `dag_${Date.now()}`;
    const dagDirPath = `${workspacePath}/.tasks/${dagId}`;
    await ipcBridge.fs.createDir.invoke({ path: dagDirPath });

    // 创建示例 DAG JSON 文件
    const sampleDag = {
      "dag_id": dagId,
      "title": "示例任务",
      "status": "completed",
      "created_at": new Date().toISOString(),
      "progress": {
        "total": 1,
        "completed": 1,
        "failed": 0,
        "skipped": 0,
        "running": 0,
        "queued": 0,
        "pending": 0
      },
      "tasks": [
        {
          "task_id": "sample_task_1",
          "name": "示例任务",
          "description": "这是一个示例 DAG 任务",
          "type": "analyze",
          "dependencies": [],
          "status": "completed",
          "metrics": {
            "duration_ms": 100,
            "input_tokens": 10,
            "output_tokens": 5,
            "total_tokens": 15
          },
          "result": {
            "content": "示例任务完成"
          }
        }
      ],
      "summary": "示例 DAG 任务已完成"
    };

    const dagFilePath = `${dagDirPath}/${dagId}.json`;
    await ipcBridge.fs.writeFile.invoke({
      path: dagFilePath,
      content: JSON.stringify(sampleDag, null, 2)
    });

    console.log(`Created sample DAG file at: ${dagFilePath}`);
    return true;
  } catch (error) {
    console.error('Error creating sample DAG file:', error);
    return false;
  }
}