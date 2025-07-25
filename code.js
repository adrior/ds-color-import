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

// Функция для создания переменной цвета
async function createColorVariable(collection, name, colorValues) {
  try {
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
    const modes = collection.modes;

    for (const [themeName, colorValue] of Object.entries(colorValues)) {
      let mode = modes.find(
        (m) => m.name.toLowerCase() === themeName.toLowerCase()
      );

      if (!mode) {
        // Создаем новый режим если его нет
        mode = collection.addMode(themeName);
      }

      const rgbColor = hexToRgb(colorValue);
      variable.setValueForMode(mode.modeId, rgbColor);
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

      // Получаем все цветовые свойства из первой темы для определения структуры
      const themes = Object.keys(jsonData);
      if (themes.length === 0) {
        throw new Error("No themes found in JSON data");
      }

      const firstTheme = jsonData[themes[0]];
      const colorProperties = Object.keys(firstTheme);

      let createdCount = 0;
      let updatedCount = 0;

      // Создаем переменные для каждого цветового свойства
      for (const colorProp of colorProperties) {
        const colorValues = {};

        // Собираем значения цвета для всех тем
        for (const theme of themes) {
          if (jsonData[theme][colorProp]) {
            colorValues[theme] = jsonData[theme][colorProp];
          }
        }

        if (Object.keys(colorValues).length > 0) {
          const existingVariables = figma.variables.getLocalVariables();
          const exists = existingVariables.some(
            (v) =>
              v.name === colorProp && v.variableCollectionId === collection.id
          );

          await createColorVariable(collection, colorProp, colorValues);

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
