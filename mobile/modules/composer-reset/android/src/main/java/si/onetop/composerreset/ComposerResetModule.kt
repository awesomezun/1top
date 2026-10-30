package si.onetop.composerreset

import android.content.Context
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hands a composer back to the keyboard afresh once its message is sent. Without it the keyboard keeps
 * the word it was composing and types it back in front of the next key ("hello" sent, "n" typed,
 * "hellon" in the field). The sent text leaves the field here, where the field's own text is current:
 * keys typed after the tap but before the app caught up stay as the start of the next message. Then
 * the composing mark is dropped, so nothing is committed again, and the keyboard's connection restarts
 * on the field as it is now.
 */
class ComposerResetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ComposerReset")

    AsyncFunction("reset") { tag: Int, sent: String ->
      val field = appContext.findView<View>(tag) as? EditText ?: return@AsyncFunction
      val text = field.text
      if (sent.isNotEmpty() && text.startsWith(sent)) text.delete(0, sent.length)
      BaseInputConnection.removeComposingSpans(text)
      val keyboard = field.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
      keyboard.restartInput(field)
    }.runOnQueue(Queues.MAIN)
  }
}
