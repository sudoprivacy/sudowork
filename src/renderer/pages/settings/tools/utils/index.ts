export const truncateErrorMessage = (message: string, maxLength = 150): string => {
  if (message.length <= maxLength) {
    return message;
  }

  return `${message.substring(0, maxLength)}...`;
};
