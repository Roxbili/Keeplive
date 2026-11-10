// JavaScript for Automation, run by /usr/bin/osascript (not Node.js).
ObjC.import('AppKit');
ObjC.import('Foundation');

function createFolderPanel(initial) {
  var app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  var panel = $.NSOpenPanel.openPanel;
  panel.title = '选择 Keeplive 照片文件夹';
  panel.prompt = '选择文件夹';
  panel.canChooseDirectories = true;
  panel.canChooseFiles = false;
  panel.allowsMultipleSelection = false;
  panel.canCreateDirectories = false;
  panel.treatsFilePackagesAsDirectories = false;
  panel.resolvesAliases = true;
  if (initial) panel.directoryURL = $.NSURL.fileURLWithPath(initial);
  return panel;
}

function run() {
  var initial = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('KEEPLIVE_PICKER_INITIAL')) || '';
  var panel = createFolderPanel(initial);
  $.NSApplication.sharedApplication.activateIgnoringOtherApps(true);
  if (panel.runModal !== $.NSModalResponseOK) return JSON.stringify({path:null,canceled:true});
  return JSON.stringify({path:ObjC.unwrap(panel.URL.path),canceled:false});
}
