// Показываем UI плагина
figma.showUI(__html__, { width: 400, height: 500 });

// Функция для получения коллекции переменных для импорта
async function getTargetVariableCollection() {
  const collections = figma.variables.getLocalVariableCollections();

  // Если есть существующие коллекции, используем первую
  if (collections.length > 0) {
    return collections[0];
  }

  // Если коллекций нет, создаем новую с именем "Local Variables"
  return figma.variables.createVariableCollection("Local Variables");
}

// Функция для конвертации hex цвета в RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    console.error(`Invalid hex color: ${hex}`);
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}

// Функция для очистки имени переменной от недопустимых символов
function sanitizeVariableName(name) {
  return name
    .replace(/[^a-zA-Z0-9\/\-_\s]/g, "") // Удаляем недопустимые символы
    .replace(/\s+/g, "-") // Заменяем пробелы на дефисы
    .replace(/^[0-9]/, "var-$&") // Добавляем префикс если начинается с цифры
    .trim();
}

// Рекурсивная функция для извлечения всех цветов из вложенной структуры
function extractColors(obj, prefix = "") {
  const colors = {};

  for (const [key, value] of Object.entries(obj)) {
    const sanitizedKey = sanitizeVariableName(key);
    const currentPath = prefix ? `${prefix}/${sanitizedKey}` : sanitizedKey;

    if (typeof value === "string" && value.startsWith("#")) {
      // Это цвет
      colors[currentPath] = value;
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Это вложенный объект, продолжаем рекурсию
      const nestedColors = extractColors(value, currentPath);
      Object.assign(colors, nestedColors);
    }
  }

  return colors;
}

// Функция для создания переменной цвета
async function createColorVariable(collection, name, colorValues) {
  try {
    // Проверяем валидность входных данных
    if (!collection) {
      throw new Error("Collection is required");
    }
    if (!name || typeof name !== "string") {
      throw new Error("Valid variable name is required");
    }
    if (!colorValues || Object.keys(colorValues).length === 0) {
      throw new Error("Color values are required");
    }

    // Проверяем, существует ли уже переменная с таким именем
    const existingVariables = figma.variables.getLocalVariables();
    const existingVar = existingVariables.find(
      (v) => v.name === name && v.variableCollectionId === collection.id
    );

    let variable;
    if (existingVar) {
      variable = existingVar;
    } else {
      variable = figma.variables.createVariable(name, collection, "COLOR");
    }

    // Устанавливаем значения для каждого режима (light/dark)
    let modes = collection.modes;

    // Проверяем что у коллекции есть режимы
    if (!modes || modes.length === 0) {
      throw new Error("Collection must have at least one mode");
    }
    const themeNames = Object.keys(colorValues);

    // Если это коллекция с только стандартным режимом "Mode 1",
    // переименовываем его в первую тему
    if (
      modes.length === 1 &&
      modes[0].name === "Mode 1" &&
      themeNames.length > 0
    ) {
      try {
        collection.renameMode(modes[0].modeId, themeNames[0]);
        modes = collection.modes; // Обновляем список режимов
      } catch (error) {
        console.error(`Error renaming mode:`, error);
      }
    }

    for (const [themeName, colorValue] of Object.entries(colorValues)) {
      let mode = modes.find(
        (m) => m.name.toLowerCase() === themeName.toLowerCase()
      );

      if (!mode) {
        try {
          // Создаем новый режим если его нет
          const newModeId = collection.addMode(themeName);
          // Обновляем список режимов после добавления нового
          modes = collection.modes;
          mode = modes.find((m) => m.modeId === newModeId);

          if (!mode) {
            console.error(`Failed to create or find mode: ${themeName}`);
            continue;
          }
        } catch (error) {
          console.error(`Error creating mode ${themeName}:`, error);
          continue;
        }
      }

      // Проверяем что mode и modeId существуют
      if (!mode || !mode.modeId) {
        console.error(`Invalid mode for theme ${themeName}:`, mode);
        continue;
      }

      try {
        const rgbColor = hexToRgb(colorValue);
        variable.setValueForMode(mode.modeId, rgbColor);
      } catch (error) {
        console.error(`Error setting value for mode ${themeName}:`, error);
        console.error(`Mode details:`, {
          modeId: mode.modeId,
          colorValue,
          rgbColor: hexToRgb(colorValue),
        });
      }
    }

    return variable;
  } catch (error) {
    console.error(`Error creating variable ${name}:`, error);
    throw error;
  }
}

// Обработка сообщений от UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === "get-collections-info") {
    const collections = figma.variables.getLocalVariableCollections();
    let targetCollectionName = "Local Variables (будет создана)";

    if (collections.length > 0) {
      targetCollectionName = collections[0].name;
    }

    figma.ui.postMessage({
      type: "collections-info",
      targetCollectionName: targetCollectionName,
    });
  } else if (msg.type === "import-variables") {
    try {
      const { fileName, jsonData } = msg;

      // Получаем существующую коллекцию или создаем новую
      const collection = await getTargetVariableCollection();

      // Получаем все темы и извлекаем цвета из каждой
      const themes = Object.keys(jsonData);
      if (themes.length === 0) {
        throw new Error("No themes found in JSON data");
      }

      // Извлекаем все цвета из каждой темы с поддержкой вложенности
      const allColorPaths = new Set();
      const themeColors = {};

      for (const theme of themes) {
        const extractedColors = extractColors(jsonData[theme]);
        themeColors[theme] = extractedColors;

        // Собираем все уникальные пути цветов
        Object.keys(extractedColors).forEach((path) => allColorPaths.add(path));
      }

      let createdCount = 0;
      let updatedCount = 0;

      // Создаем переменные для каждого пути цвета
      for (const colorPath of allColorPaths) {
        const colorValues = {};

        // Собираем значения цвета для всех тем
        for (const theme of themes) {
          if (themeColors[theme][colorPath]) {
            colorValues[theme] = themeColors[theme][colorPath];
          }
        }

        if (Object.keys(colorValues).length > 0) {
          const existingVariables = figma.variables.getLocalVariables();
          const exists = existingVariables.some(
            (v) =>
              v.name === colorPath && v.variableCollectionId === collection.id
          );

          await createColorVariable(collection, colorPath, colorValues);

          if (exists) {
            updatedCount++;
          } else {
            createdCount++;
          }
        }
      }

      figma.ui.postMessage({
        type: "import-success",
        message: `Import completed! Created: ${createdCount}, Updated: ${updatedCount} variables in collection "${collection.name}"`,
      });
    } catch (error) {
      console.error("Import error:", error);
      figma.ui.postMessage({
        type: "import-error",
        message: `Import failed: ${error.message}`,
      });
    }
  } else if (msg.type === "close-plugin") {
    figma.closePlugin();
  }
};
