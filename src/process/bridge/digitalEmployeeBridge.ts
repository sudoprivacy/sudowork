/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { parseError } from '@/common/utils';
import { digitalEmployeeService } from '@process/services/digitalEmployee/DigitalEmployeeService';

export function initDigitalEmployeeBridge(): void {
  ipcBridge.digitalEmployee.list.provider(async () => {
    try {
      return { success: true, data: digitalEmployeeService.listEmployees() };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.get.provider(async ({ employeeId }) => {
    try {
      return { success: true, data: digitalEmployeeService.getEmployee(employeeId) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.create.provider(async (input) => {
    try {
      return { success: true, data: digitalEmployeeService.createEmployee(input) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.update.provider(async ({ employeeId, updates }) => {
    try {
      return { success: true, data: digitalEmployeeService.updateEmployee(employeeId, updates) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.remove.provider(async ({ employeeId }) => {
    try {
      digitalEmployeeService.removeEmployee(employeeId);
      return { success: true, data: undefined };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.duplicate.provider(async ({ employeeId }) => {
    try {
      return { success: true, data: digitalEmployeeService.duplicateEmployee(employeeId) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.bindResource.provider(async ({ employeeId, resource }) => {
    try {
      return { success: true, data: digitalEmployeeService.bindResource(employeeId, resource) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.unbindResource.provider(async ({ resourceId }) => {
    try {
      digitalEmployeeService.unbindResource(resourceId);
      return { success: true, data: undefined };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.listSops.provider(async ({ employeeId }) => {
    try {
      return { success: true, data: digitalEmployeeService.listSops(employeeId) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.getSop.provider(async ({ sopId }) => {
    try {
      return { success: true, data: digitalEmployeeService.getSop(sopId) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.distillSop.provider(async (input) => {
    try {
      return { success: true, data: digitalEmployeeService.distillSop(input) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.createSop.provider(async ({ employeeId, sop }) => {
    try {
      return { success: true, data: digitalEmployeeService.createSop(employeeId, sop) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.updateSop.provider(async ({ sopId, updates }) => {
    try {
      return { success: true, data: digitalEmployeeService.updateSop(sopId, updates) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.removeSop.provider(async ({ sopId }) => {
    try {
      digitalEmployeeService.removeSop(sopId);
      return { success: true, data: undefined };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.listWorkRecords.provider(async ({ employeeId }) => {
    try {
      return { success: true, data: digitalEmployeeService.listWorkRecords(employeeId) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });

  ipcBridge.digitalEmployee.launchConversation.provider(async (input) => {
    try {
      return { success: true, data: await digitalEmployeeService.launchConversation(input) };
    } catch (error) {
      return { success: false, msg: parseError(error) };
    }
  });
}
